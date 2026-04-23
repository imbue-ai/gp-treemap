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

#import <Cocoa/Cocoa.h>

@class FilterTestRepository;
@class FilterTestEditor;
@class NamedFilter;
@protocol NameValidator;

/* A control for a FilterWindow.
 *
 * The control fires "okPerformed", "cancelPerformed", "applyPerformed", and "closePerformed"
 * notifications to signal that respectively the OK, Cancel, Apply and Close buttons have been
 * pressed. This allows the window to be run modally (e.g. when used to apply a Filter from the main
 * menu), as well as normally (e.g. when used to set/change a mask for a specific directory view
 * window).
 */
@interface FilterWindowControl 
  : NSWindowController <NSTableViewDataSource, NSTableViewDelegate> {

  IBOutlet NSTextField  *filterNameField;

  IBOutlet NSButton  *okButton;

  IBOutlet NSButton  *removeTestFromRepositoryButton;
  IBOutlet NSButton  *editTestInRepositoryButton;

  IBOutlet NSButton  *addTestToFilterButton;
  IBOutlet NSButton  *removeTestFromFilterButton;
  IBOutlet NSButton  *removeAllTestsFromFilterButton;
  
  IBOutlet NSTableView  *filterTestsView;
  IBOutlet NSTableView  *availableTestsView;

  // The first responder when updateWindowState: was last called.
  NSResponder  *firstResponder;
  
  FilterTestRepository  *testRepository;
  FilterTestEditor  *testEditor;
  
  NSObject <NameValidator>  *nameValidator;
  // Set to the last name (if any) that has been reported invalid.
  NSString  *invalidName;

  // Non-localized name of the filter.
  NSString  *filterName;

  NSMutableArray  *filterTests;
  NSMutableArray  *availableTests;
  
  // Indicates iff an "okPerformed", "cancelPerformed" or "closePerformed" notification has been
  // fired already.
  BOOL  finalNotificationFired;
  
  // Controls if an empty filter (i.e. a filter without any tests) is allowed.
  BOOL  allowEmptyFilter;
}

- (IBAction) cancelAction:(id)sender;
- (IBAction) okAction:(id)sender;

- (IBAction) filterNameChanged:(id)sender;

- (IBAction) addTestToRepository:(id)sender;
- (IBAction) removeTestFromRepository:(id)sender;
- (IBAction) editTestInRepository:(id)sender;

- (IBAction) addTestToFilter:(id)sender;
- (IBAction) removeTestFromFilter:(id)sender;
- (IBAction) removeAllTestsFromFilter:(id)sender;

- (IBAction) testDoubleClicked:(id)sender;

// Override designated initialisers
- (instancetype) initWithWindow:(NSWindow *)window NS_UNAVAILABLE;
- (instancetype) initWithCoder:(NSCoder *)coder NS_UNAVAILABLE;

- (instancetype) initWithTestRepository:(FilterTestRepository *)testRepository NS_DESIGNATED_INITIALIZER;

@property (nonatomic) BOOL allowEmptyFilter;

/* Returns the name of the filter, given the current window state.
 */
@property (nonatomic, readonly, copy) NSString *filterName;

- (void) setNameValidator:(NSObject<NameValidator> *)validator;

/* Configures the window to represent an empty filter.
 */
- (void) representEmptyFilter;

/* Configures the window to represent the given filter. It copies the state of the original filter
 * (as far as possible, given that some filter tests may not exist anymore) and leaves the provided
 * filter unchanged.
 */
- (void) representNamedFilter:(NamedFilter *)filterVal;

/* Returns a filter that represents the current window state.
 */
- (NamedFilter *)createNamedFilter;

/* Sets the name of the filter as it is shown in the window. This may be different from the actual
 * name  (in particular, the visible name may be localized). Once a visible name is set, it cannot
 * be changed.
 */
- (void) setVisibleName:(NSString *)name;

@end
