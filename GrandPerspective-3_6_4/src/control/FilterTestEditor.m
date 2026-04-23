/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "FilterTestEditor.h"

#import "NameValidator.h"
#import "ModalityTerminator.h"
#import "NotifyingDictionary.h"

#import "FilterTest.h"
#import "FilterTestRepository.h"

#import "FilterTestWindowControl.h"


/* Performs a validity check on the name of filter tests (before the window is closed using the OK
 * button).
 */
@interface FilterTestNameValidator : NSObject <NameValidator> {
  NSDictionary  *allTests;
  NSString  *allowedName;
}

// Overrides designated initialiser.
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithExistingTests:(NSDictionary *)allTests;
- (instancetype) initWithExistingTests:(NSDictionary *)allTests
                           allowedName:(NSString *)name NS_DESIGNATED_INITIALIZER;

@end // @interface FilterTestNameValidator



@interface FilterTestEditor (PrivateMethods)

@property (nonatomic, readonly, strong) NSWindow *loadEditFilterTestWindow;

@end // @interface FilterTestEditor (PrivateMethods)



@implementation FilterTestEditor

- (instancetype) init {
  return [self initWithFilterTestRepository: FilterTestRepository.defaultFilterTestRepository];
}

- (instancetype) initWithFilterTestRepository:(FilterTestRepository *)repository {
  if (self = [super init]) {
    filterTestWindowControl = nil; // Load it lazily
  
    testRepository = [repository retain];
  }
  return self;
}

- (void) dealloc {
  [filterTestWindowControl release];

  [testRepository release];
  
  [super dealloc];
}


- (FilterTest *)createFilterTest {
  NSWindow  *editTestWindow = [self loadEditFilterTestWindow];
  
  FilterTestNameValidator  *testNameValidator = 
    [[[FilterTestNameValidator alloc] initWithExistingTests: testRepository.testsByName]
     autorelease];
  
  [filterTestWindowControl setNameValidator: testNameValidator];
  [filterTestWindowControl representFilterTest: nil];

  [ModalityTerminator modalityTerminatorForEventSource: filterTestWindowControl];
  NSInteger  status = [NSApp runModalForWindow: editTestWindow];
  [editTestWindow close];

  if (status == NSModalResponseStop) {
    FilterTest  *filterTest = [filterTestWindowControl createFilterTest];
    
    if (filterTest != nil) {
      // The nameValidator should have ensured that this check succeeds.
      NSAssert(testRepository.testsByName[filterTest.name] == nil,
               @"Duplicate name check failed.");

      [[testRepository testsByNameAsNotifyingDictionary] addObject: filterTest.fileItemTest
                                                            forKey: filterTest.name];
        
      // Rest of addition handled in response to notification event.
    }
    
    return filterTest;
  }
  else {
    NSAssert(status == NSModalResponseAbort, @"Unexpected status.");
  
    return nil;
  }
}

- (FilterTest *)editFilterTestNamed:(NSString *)oldName {
  NSWindow  *editTestWindow = [self loadEditFilterTestWindow];

  FileItemTest  *oldTest = testRepository.testsByName[oldName];

  [filterTestWindowControl representFilterTest: 
     [FilterTest filterTestWithName: oldName fileItemTest: oldTest]];

  if ([testRepository applicationProvidedTestForName: oldName] != nil) {
    // The test's name equals that of an application provided test. Show the localized version of
    // the name (which implicitly prevents the name from being changed).
  
    NSBundle  *mainBundle = NSBundle.mainBundle;
    NSString  *localizedName =
      [mainBundle localizedStringForKey: oldName value: nil table: @"Names"];
      
    [filterTestWindowControl setVisibleName: localizedName];
  }
  
  FilterTestNameValidator  *testNameValidator =
    [[[FilterTestNameValidator alloc] initWithExistingTests: testRepository.testsByName
                                                allowedName: oldName] autorelease];
  
  [filterTestWindowControl setNameValidator: testNameValidator];
  
  [ModalityTerminator modalityTerminatorForEventSource: filterTestWindowControl];
  NSInteger  status = [NSApp runModalForWindow: editTestWindow];
  [editTestWindow close];
    
  if (status == NSModalResponseStop) {
    FilterTest  *newFilterTest = [filterTestWindowControl createFilterTest];
    
    if (newFilterTest != nil) {
      NSString  *newName = [newFilterTest name];

      // The terminationControl should have ensured that this check succeeds.
      NSAssert([newName isEqualToString: oldName] ||
               testRepository.testsByName[newName] == nil,
               @"Duplicate name check failed.");

      if (! [newName isEqualToString: oldName]) {
        // Handle name change.
        [testRepository.testsByNameAsNotifyingDictionary moveObjectFromKey: oldName
                                                                     toKey: newName];
          
        // Rest of rename handled in response to update notification event.
      }
        
      // Test itself has changed as well.
      [testRepository.testsByNameAsNotifyingDictionary updateObject: newFilterTest.fileItemTest
                                                             forKey: newName];

      // Rest of update handled in response to update notification event.
    }
    
    return newFilterTest;
  }
  else {
    NSAssert(status == NSModalResponseAbort, @"Unexpected status.");
    
    return nil;
  }
}

@end // @implementation FilterTestEditor


@implementation FilterTestEditor (PrivateMethods)

- (NSWindow *)loadEditFilterTestWindow {
  if (filterTestWindowControl == nil) {
    filterTestWindowControl = [[FilterTestWindowControl alloc] init];
  }
  // Return its window. This also ensure that it is loaded before its control is used.
  return filterTestWindowControl.window;
}

@end // @implementation FilterTestEditor (PrivateMethods)


@implementation FilterTestNameValidator

- (instancetype) initWithExistingTests:(NSDictionary *)allTestsVal {
  return [self initWithExistingTests: allTestsVal allowedName: nil];
}

- (instancetype) initWithExistingTests:(NSDictionary *)allTestsVal
                           allowedName:(NSString *)name {
  if (self = [super init]) {
    allTests = [allTestsVal retain];
    allowedName = [name retain];    
  }
  
  return self;
}

- (void) dealloc {
  [allTests release];
  [allowedName release];

  [super dealloc];
}


- (NSString *)checkNameIsValid:(NSString *)name {
  if ([name isEqualToString:@""]) {
    return NSLocalizedString(@"The test must have a name", @"Alert message");
  }
  else if (![allowedName isEqualToString: name] && allTests[name] != nil) {
    NSString  *fmt = NSLocalizedString(@"A test named \"%@\" already exists", @"Alert message");
    return [NSString stringWithFormat: fmt, name];
  }
  
  // All OK
  return nil;
}

@end // @implementation FilterTestNameValidator
