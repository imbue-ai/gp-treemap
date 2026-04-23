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

#import "FiltersWindowControl.h"

#import "ControlConstants.h"
#import "NotifyingDictionary.h"

#import "Filter.h"
#import "NamedFilter.h"
#import "FilterEditor.h"
#import "FilterRepository.h"


@interface FiltersWindowControl (PrivateMethods)

// Returns the non-localized name of the selected available filter (if any).
@property (nonatomic, readonly, copy) NSString *selectedFilterName;

- (void) selectFilterNamed:(NSString *)name;

- (void) updateWindowState;

- (void) filterAddedToRepository:(NSNotification *)notification;
- (void) filterRemovedFromRepository:(NSNotification *)notification;
- (void) filterUpdatedInRepository:(NSNotification *)notification;
- (void) filterRenamedInRepository:(NSNotification *)notification;

- (void) deleteFilter:(NSString *)filterName;

@end // @interface FiltersWindowControl (PrivateMethods)


@implementation FiltersWindowControl

- (instancetype) init {
  return [self initWithFilterRepository: FilterRepository.defaultFilterRepository];
}

- (instancetype) initWithFilterRepository:(FilterRepository *)filterRepositoryVal {
  if (self = [super initWithWindow: nil]) {
    filterRepository = [filterRepositoryVal retain];

    filterEditor = [[FilterEditor alloc] initWithFilterRepository: filterRepository];

    NotifyingDictionary  *repositoryFiltersByName = 
      filterRepository.filtersByNameAsNotifyingDictionary;
    NSNotificationCenter  *nc = repositoryFiltersByName.notificationCenter;

    [nc addObserver: self
           selector: @selector(filterAddedToRepository:)
               name: ObjectAddedEvent
             object: repositoryFiltersByName];
    [nc addObserver: self
           selector: @selector(filterRemovedFromRepository:)
               name: ObjectRemovedEvent
             object: repositoryFiltersByName];
    [nc addObserver: self
           selector: @selector(filterUpdatedInRepository:)
               name: ObjectUpdatedEvent
             object: repositoryFiltersByName];
    [nc addObserver: self
           selector: @selector(filterRenamedInRepository:)
               name: ObjectRenamedEvent
             object: repositoryFiltersByName];

    filterNames =
      [[NSMutableArray alloc] initWithCapacity: filterRepository.filtersByName.count + 8];
    [filterNames addObjectsFromArray: filterRepository.filtersByName.allKeys];
    [filterNames sortUsingSelector: @selector(compare:)];
    
    filterNameToSelect = nil;
  }
  return self;
}

- (void) dealloc {
  NSNotificationCenter  *nc =
    filterRepository.filtersByNameAsNotifyingDictionary.notificationCenter;
  [nc removeObserver: self];

  [filterRepository release];
  
  [filterEditor release];

  [filterNames release];
  [filterNameToSelect release];
  
  [super dealloc];
}


- (NSString *)windowNibName {
  return @"FiltersWindow";
}


- (IBAction) okAction:(id)sender {
  [self.window close];
}

- (void)cancelOperation:(id)sender {
  [self.window close];
}

- (IBAction) addFilterToRepository:(id)sender {
  NamedFilter  *newFilter = [filterEditor createNamedFilter];
  
  [self selectFilterNamed: newFilter.name];
  [self.window makeFirstResponder: filterView];
}

- (IBAction) editFilterInRepository:(id)sender {
  NSString  *oldName = [self selectedFilterName];
  [filterEditor editFilterNamed: oldName];
}

- (IBAction) removeFilterFromRepository:(id)sender {
  NSString  *filterName = [self selectedFilterName];  
  NSAlert  *alert = [[[NSAlert alloc] init] autorelease];
  NSString  *fmt = NSLocalizedString(@"Remove the filter named \"%@\"?", @"Alert message");
  NSString  *infoMsg = 
    ([filterRepository applicationProvidedFilterForName: filterName] != nil) ?
      NSLocalizedString(@"The filter will be replaced by the default filter with this name",
                        @"Alert informative text") :
      NSLocalizedString(@"The filter will be irrevocably removed from the filter repository",
                        @"Alert informative text");

  NSBundle  *mainBundle = NSBundle.mainBundle;
  NSString  *localizedName =
    [mainBundle localizedStringForKey: filterName value: nil table: @"Names"];
  
  [alert addButtonWithTitle: REMOVE_BUTTON_TITLE];
  [alert addButtonWithTitle: CANCEL_BUTTON_TITLE];
  alert.messageText = [NSString stringWithFormat: fmt, localizedName];
  alert.informativeText = infoMsg;

  [alert beginSheetModalForWindow: self.window completionHandler:^(NSModalResponse returnCode) {
    if (returnCode == NSAlertFirstButtonReturn) {
      [self deleteFilter: filterName];
    }
  }];
}

- (void) windowDidLoad {
  filterView.delegate = self;
  filterView.dataSource = self;
      
  [self updateWindowState];
}


//----------------------------------------------------------------------------
// NSTableSource

- (NSInteger) numberOfRowsInTableView:(NSTableView *)tableView {
  return filterNames.count;
}

- (id) tableView:(NSTableView *)tableView objectValueForTableColumn:(NSTableColumn *)column
             row:(NSInteger)row {
  NSString  *filterName = filterNames[row];
  NSBundle  *mainBundle = NSBundle.mainBundle;
  return [mainBundle localizedStringForKey: filterName value: nil table: @"Names"];

}


//----------------------------------------------------------------------------
// Delegate methods for NSTable

- (void) tableViewSelectionDidChange:(NSNotification *)notification {
  [self updateWindowState];
}

@end // @implementation FiltersWindowControl


@implementation FiltersWindowControl (PrivateMethods)

- (NSString *)selectedFilterName {
  NSInteger  index = filterView.selectedRow;
  return (index < 0) ? nil : filterNames[index];
}


- (void) selectFilterNamed:(NSString *)name {
  NSUInteger  row = [filterNames indexOfObject: name];
  if (row != NSNotFound) {
    [filterView selectRowIndexes: [NSIndexSet indexSetWithIndex: row] byExtendingSelection: NO];
  }
  else {
    [filterView deselectAll: self];
  }
}

- (void) updateWindowState {
  NSString  *filterName = [self selectedFilterName];
  
  editFilterButton.enabled = (filterName != nil) ;
  
  removeFilterButton.enabled = (filterName != nil &&
        ( [filterRepository applicationProvidedFilterForName: filterName] !=
          [filterRepository filterForName: filterName] ));
}


- (void) filterAddedToRepository:(NSNotification *)notification {
  NSString  *name = notification.userInfo[@"key"];
  NSString  *selectedName = [self selectedFilterName];

  [filterNames addObject: name];

  // Ensure that the filters remain sorted.
  [filterNames sortUsingSelector: @selector(compare:)];
  [filterView reloadData];
        
  if (selectedName != nil) {
    // Make sure that the same filter is still selected.
    [self selectFilterNamed: selectedName];
  }
                
  [self updateWindowState];
}


- (void) filterRemovedFromRepository:(NSNotification *)notification {
  NSString  *name = notification.userInfo[@"key"];
  NSString  *selectedName = [self selectedFilterName];

  NSUInteger  index = [filterNames indexOfObject: name];
  NSAssert(index != NSNotFound, @"Filter not found.");

  [filterNames removeObjectAtIndex: index];
  [filterView reloadData];
  
  if ([name isEqualToString: selectedName]) {
    // The removed filter was selected. Clear the selection.
    [filterView deselectAll: self];
  }
  else if (selectedName != nil) {
    // Make sure that the same filter is still selected.
    [self selectFilterNamed: selectedName];
  }

  [self updateWindowState];
}


- (void) filterUpdatedInRepository:(NSNotification *)notification {
  [self updateWindowState];
}


- (void) filterRenamedInRepository:(NSNotification *)notification {
  NSString  *oldName = notification.userInfo[@"oldkey"];
  NSString  *newName = notification.userInfo[@"newkey"];

  NSUInteger  index = [filterNames indexOfObject: oldName];
  NSAssert(index != NSNotFound, @"Filter not found.");

  NSString  *selectedName = [self selectedFilterName];

  filterNames[index] = newName;
  [filterNames sortUsingSelector: @selector(compare:)];
  [filterView reloadData];
    
  if ([selectedName isEqualToString: oldName]) {
    // It was selected, so make sure it still is.
    selectedName = newName;
  }
  if (selectedName != nil) {
    // Make sure that the same test is still selected.
    [self selectFilterNamed: selectedName];
  }
}


- (void) deleteFilter:(NSString *)filterName {
  Filter  *defaultFilter =
  [filterRepository applicationProvidedFilterForName: filterName];
  NotifyingDictionary  *repositoryFiltersByName =
  [filterRepository filtersByNameAsNotifyingDictionary];

  if (defaultFilter == nil) {
    [repositoryFiltersByName removeObjectForKey: filterName];
  }
  else {
    // Replace it by the application-provided filter with the same name (this would happen anyway
    // when the application is restarted).
    [repositoryFiltersByName updateObject: defaultFilter forKey: filterName];
  }

  // Rest of delete handled in response to notification event.
}

@end // @implementation FiltersWindowControl (PrivateMethods)

